import type { WalletFeatureConfig } from "../wallet/types";

export type TransferAsset = "USDC" | "HYPE";

export type TransferDirection = "core_to_evm" | "evm_to_core";

export type TransferLocation = "hyperCore" | "hyperEvm";

export type TransferBalanceState = "available" | "zero" | "unavailable";

export type TransferBalance = {
  symbol: TransferAsset;
  decimals: number;
  raw: string | null;
  formatted: string | null;
  state: TransferBalanceState;
  available: boolean;
  reason: string | null;
};

export type TransferAssetMetadata = {
  asset: TransferAsset;
  symbol: TransferAsset;
  decimals: number;
  hyperCoreToken: string | null;
  evmAssetType: "erc20" | "native";
  evmTokenAddress: `0x${string}` | null;
  systemAddress: `0x${string}` | null;
  coreDepositWalletAddress: `0x${string}` | null;
};

export type TransferGasRequirement = {
  asset: "HYPE";
  location: TransferLocation;
  required: boolean;
  available: boolean;
  balance: TransferBalance;
  detail: string;
  reason: string | null;
};

export type TransferCapability = {
  id: string;
  direction: TransferDirection;
  asset: TransferAsset;
  supported: boolean;
  mode: "client_write";
  reason: string | null;
  systemAddress: `0x${string}` | null;
  coreDepositWalletAddress: `0x${string}` | null;
  hyperCoreToken: string | null;
  evmAssetType: "erc20" | "native";
  evmTokenAddress: `0x${string}` | null;
  requiresChainId: number | null;
  gas: TransferGasRequirement;
};

export type TransferProtocolInfo = {
  domainsDescription: string;
  timingCoreToEvm: string;
  timingEvmToCore: string;
  notes: string[];
};

export type HyperCoreTransferBalances = {
  location: "hyperCore";
  address: string;
  source: "spotClearinghouseState";
  available: boolean;
  reason: string | null;
  usdc: TransferBalance;
  hype: TransferBalance;
  updatedAt: string;
};

export type HyperEvmNetworkStatus = {
  chainId: number;
  expectedChainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
};

export type HyperEvmTransferBalances = {
  location: "hyperEvm";
  address: string;
  available: boolean;
  reason: string | null;
  network: HyperEvmNetworkStatus;
  usdc: TransferBalance;
  hype: TransferBalance;
  updatedAt: string;
};

export type WalletTransferOverview = {
  address: string;
  assets: TransferAssetMetadata[];
  hyperCore: HyperCoreTransferBalances;
  hyperEvm: HyperEvmTransferBalances;
  capabilities: TransferCapability[];
  protocol: TransferProtocolInfo;
  updatedAt: string;
};

export type TransferExecutionState = {
  phase: "idle" | "awaiting_signature" | "submitted" | "queued" | "confirmed" | "error";
  message?: string;
  txHash?: string | null;
  code?: string;
};

export type TransferFeatureConfig = {
  hyperEvm: WalletFeatureConfig["chain"];
  wallet: WalletFeatureConfig;
  hyperliquidExchangeUrl: string;
  signatureChainId: number;
  coreDepositWalletAddress: `0x${string}` | null;
  systemAddress: `0x${string}` | null;
};
