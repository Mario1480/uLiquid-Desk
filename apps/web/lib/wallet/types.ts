import type { Abi } from "viem";

export type MasterVaultAdapterId = "legacy_token_amount" | "eip4626" | "mock";

export type WalletFeatureConfig = {
  chain: {
    id: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
  };
  usdc: {
    address: string | null;
    symbol: string;
    decimals: number;
  };
  masterVault: {
    address: string | null;
    abi: Abi | null;
    adapter: MasterVaultAdapterId;
    depositFunctionName: string | null;
    approveSpender: string | null;
    errors: string[];
    writeEnabled: boolean;
  };
};

export type WalletBalanceSnapshot = {
  symbol: string;
  decimals: number;
  raw: string;
  formatted: string;
};

export type PortfolioPoint = {
  time: number;
  value: number | null;
  pnl: number | null;
};

export type WalletOverviewResponse = {
  address: string;
  network: {
    chainId: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
  };
  balances: {
    hype: WalletBalanceSnapshot;
    usdc: WalletBalanceSnapshot | null;
  };
  vaultSummary: {
    count: number;
    totalEquityUsd: number;
  };
  portfolio: {
    points: PortfolioPoint[];
    available: boolean;
  };
  role: string | null;
  masterVault: {
    configured: boolean;
    address: string | null;
    usdcAddress: string | null;
  };
  config: {
    errors: string[];
  };
  updatedAt: string;
};

export type MasterVaultSummaryResponse = {
  id: string;
  userId: string;
  onchainAddress: string | null;
  freeBalance: number;
  reservedBalance: number;
  withdrawableBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalAllocatedUsd: number;
  totalRealizedNetUsd: number;
  totalProfitShareAccruedUsd: number;
  totalWithdrawnUsd: number;
  availableUsd: number;
  status: string;
  botVaultCount: number;
  updatedAt: string | null;
};

export type WalletVaultItem = {
  vaultAddress: string;
  name: string | null;
  leader: string | null;
  description: string | null;
  userEquityUsd: number | null;
  userRole: string | null;
  apr: number | null;
  allTimeReturnPct: number | null;
  tvlUsd: number | null;
  followerCount: number | null;
};

export type WalletVaultsResponse = {
  address: string;
  items: WalletVaultItem[];
  updatedAt: string;
};

export type WalletActivityItem = {
  id: string;
  type: "fill";
  symbol: string | null;
  side: string | null;
  size: number | null;
  price: number | null;
  closedPnlUsd: number | null;
  feeUsd: number | null;
  timestamp: number;
  txHash: string | null;
};

export type WalletActivityResponse = {
  address: string;
  items: WalletActivityItem[];
  updatedAt: string;
};

export type VaultDetailResponse = {
  vaultAddress: string;
  name: string | null;
  leader: string | null;
  description: string | null;
  userEquityUsd: number | null;
  userRole: string | null;
  apr: number | null;
  allTimeReturnPct: number | null;
  maxDrawdownPct: number | null;
  tvlUsd: number | null;
  followerCount: number | null;
  performance: {
    points: PortfolioPoint[];
    available: boolean;
  };
  updatedAt: string;
};
