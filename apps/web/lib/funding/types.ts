import type { WalletFeatureConfig } from "../wallet/types";

export type FundingLocation = "arbitrum" | "hyperCore" | "hyperEvm" | "masterVault";

export type FundingBalanceState = "available" | "zero" | "unavailable";

export type FundingStageId =
  | "arbitrum_usdc"
  | "arbitrum_eth"
  | "hypercore_usdc"
  | "hypercore_hype"
  | "hyperevm_usdc"
  | "hyperevm_hype"
  | "mastervault_ready";

export type FundingStageStatus = "success" | "warning" | "missing" | "unknown";

export type FundingActionId =
  | "fund_arbitrum_usdc"
  | "fund_arbitrum_eth"
  | "deposit_usdc_to_hyperliquid"
  | "obtain_hype_bootstrap"
  | "transfer_usdc_core_to_evm"
  | "transfer_hype_core_to_evm"
  | "deposit_master_vault"
  | "ready";

export type FundingActionKind = "external_handoff" | "client_write" | "blocked";

export type FundingBalance = {
  symbol: string;
  decimals: number;
  raw: string | null;
  formatted: string | null;
  state: FundingBalanceState;
  available: boolean;
  reason: string | null;
};

export type ArbitrumBalances = {
  location: "arbitrum";
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
  address: string;
  eth: FundingBalance;
  usdc: FundingBalance;
  updatedAt: string;
};

export type HyperCoreBalances = {
  location: "hyperCore";
  address: string;
  source: "spotClearinghouseState";
  available: boolean;
  reason: string | null;
  usdc: FundingBalance;
  hype: FundingBalance;
  updatedAt: string;
};

export type HyperEvmBalances = {
  location: "hyperEvm";
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
  address: string;
  hype: FundingBalance;
  usdc: FundingBalance;
  updatedAt: string;
};

export type MasterVaultReadiness = {
  location: "masterVault";
  configured: boolean;
  writeEnabled: boolean;
  address: string | null;
  reasons: string[];
  status: "ready" | "blocked";
};

export type FundingStage = {
  id: FundingStageId;
  status: FundingStageStatus;
  balanceLabel: string | null;
  detail: string;
  actionId: FundingActionId | null;
  blocking: boolean;
};

export type FundingReadiness = {
  currentStage: FundingStageId | "ready";
  missingRequirements: string[];
  recommendedAction: FundingActionId;
  depositEnabled: boolean;
  stages: FundingStage[];
  updatedAt: string;
};

export type FundingAction = {
  id: FundingActionId;
  kind: FundingActionKind;
  label: string;
  description: string;
  locationFrom: FundingLocation | null;
  locationTo: FundingLocation | null;
  enabled: boolean;
  reason: string | null;
  href: string | null;
  chainId: number | null;
  asset: "USDC" | "ETH" | "HYPE" | null;
  external: boolean;
};

export type TransferCapability = {
  id: string;
  direction: "core_to_evm" | "evm_to_core";
  asset: "USDC" | "HYPE";
  supported: boolean;
  mode: "external_handoff" | "client_write";
  href: string | null;
  reason: string | null;
};

export type FundingExternalLink = {
  id: "hyperliquid_deposit" | "hyperliquid_core_evm_transfer";
  label: string;
  href: string | null;
  enabled: boolean;
  reason: string | null;
};

export type FundingBridgeRouteStatus = "ready" | "warning" | "blocked";

export type FundingBridgeRoute = {
  enabled: boolean;
  status: FundingBridgeRouteStatus;
  reason: string | null;
  missingRequirements: string[];
};

export type FundingBridgeLinks = {
  officialAppUrl: string | null;
  depositContractExplorerUrl: string | null;
  hyperliquidExchangeUrl: string | null;
};

export type FundingBridgeOverview = {
  asset: "USDC";
  sourceLocation: "arbitrum";
  destinationLocation: "hyperCore";
  nativeUsdcOnly: true;
  minDepositUsd: string;
  withdrawFeeUsd: string;
  depositContractAddress: string | null;
  creditedBalance: FundingBalance;
  creditedBalanceSource: "clearinghouseState.withdrawable";
  creditedLocationLabel: string;
  deposit: FundingBridgeRoute;
  withdraw: FundingBridgeRoute;
  links: FundingBridgeLinks;
};

export type WalletFundingOverview = {
  address: string;
  arbitrum: ArbitrumBalances;
  hyperCore: HyperCoreBalances;
  hyperEvm: HyperEvmBalances;
  masterVault: MasterVaultReadiness;
  bridge: FundingBridgeOverview;
  readiness: FundingReadiness;
  actions: FundingAction[];
  transferCapabilities: TransferCapability[];
  externalLinks: FundingExternalLink[];
  updatedAt: string;
};

export type FundingReadinessResponse = {
  address: string;
  readiness: FundingReadiness;
  updatedAt: string;
};

export type FundingHistoryItem = {
  id: string;
  actionId: FundingActionId | "master_vault_deposit";
  title: string;
  description: string;
  locationFrom: FundingLocation | null;
  locationTo: FundingLocation | null;
  status: "prepared" | "submitted" | "confirmed" | "failed" | "external";
  txHash: string | null;
  chainId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FundingHistoryResponse = {
  address: string;
  trackingMode: "lightweight";
  note: string;
  items: FundingHistoryItem[];
  updatedAt: string;
};

export type FundingExternalLinksResponse = {
  address: string;
  links: FundingExternalLink[];
  updatedAt: string;
};

export type FundingFeatureConfig = {
  arbitrum: {
    chainId: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    usdcAddress: string | null;
    usdcDecimals: number;
  };
  hyperEvm: WalletFeatureConfig["chain"];
  hyperliquidExchangeUrl: string;
  bridge: {
    depositContractAddress: string | null;
    minDepositUsdc: number;
    withdrawFeeUsdc: number;
    officialAppUrl: string | null;
  };
  externalLinks: {
    depositUrl: string | null;
    coreTransferUrl: string | null;
  };
  wallet: WalletFeatureConfig;
};

export type FundingLiveBalances = {
  arbitrum: {
    eth: FundingBalance | null;
    usdc: FundingBalance | null;
  };
  hyperEvm: {
    hype: FundingBalance | null;
    usdc: FundingBalance | null;
  };
};
