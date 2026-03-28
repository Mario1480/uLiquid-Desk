import { createPublicClient, defineChain, formatUnits, http, isAddress, parseAbi } from "viem";
import type { PublicClient } from "viem";
import { resolveWalletReadConfig, type WalletReadConfig } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const erc20ReadAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

type HyperliquidInfoRequest =
  | { type: "userVaultEquities"; user: `0x${string}` }
  | { type: "vaultDetails"; vaultAddress: `0x${string}`; user?: `0x${string}` }
  | { type: "portfolio"; user: `0x${string}` }
  | { type: "userRole"; user: `0x${string}` }
  | { type: "userFillsByTime"; user: `0x${string}`; startTime: number };

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

export type WalletActivityItem = {
  id: string;
  type: "fill" | "action";
  symbol: string | null;
  title: string | null;
  description: string | null;
  side: string | null;
  size: number | null;
  price: number | null;
  closedPnlUsd: number | null;
  feeUsd: number | null;
  status: "prepared" | "submitted" | "confirmed" | "failed" | null;
  timestamp: number;
  txHash: string | null;
};

export type WalletActivitySourceItem = {
  id: string;
  actionType: string;
  status: string;
  txHash: string | null;
  chainId: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type WalletActivityResponse = {
  address: string;
  items: WalletActivityItem[];
  updatedAt: string;
};

export type WalletReadService = {
  getWalletOverview(params: { address: string }): Promise<WalletOverviewResponse>;
  getWalletVaults(params: { address: string }): Promise<{ address: string; items: WalletVaultItem[]; updatedAt: string }>;
  getVaultDetails(params: { vaultAddress: string; userAddress?: string | null }): Promise<VaultDetailResponse>;
  getWalletActivity(params: { address: string; limit?: number; items?: WalletActivitySourceItem[] | null }): Promise<WalletActivityResponse>;
};

function toAddress(value: string): `0x${string}` {
  return value.trim().toLowerCase() as `0x${string}`;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  const raw = String(value ?? "").trim();
  if (!raw || !isAddress(raw)) return null;
  return toAddress(raw);
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

function pickNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickString(source: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(source?.[key]);
    if (value) return value;
  }
  return null;
}

function normalizeBalance(symbol: string, decimals: number, rawValue: bigint): WalletBalanceSnapshot {
  return {
    symbol,
    decimals,
    raw: rawValue.toString(),
    formatted: formatUnits(rawValue, decimals)
  };
}

function normalizePortfolioPoints(input: unknown): PortfolioPoint[] {
  const rawPoints = Array.isArray(input)
    ? input
    : Array.isArray((input as any)?.accountValueHistory)
      ? (input as any).accountValueHistory
      : Array.isArray((input as any)?.portfolio)
        ? (input as any).portfolio
        : Array.isArray((input as any)?.history)
          ? (input as any).history
          : [];

  return rawPoints
    .map((entry): PortfolioPoint | null => {
      if (Array.isArray(entry)) {
        const time = asNumber(entry[0]);
        if (time === null) return null;
        return {
          time,
          value: asNumber(entry[1]),
          pnl: asNumber(entry[2])
        };
      }

      const time = pickNumber(entry, ["time", "ts", "timestamp"]);
      if (time === null) return null;
      return {
        time,
        value: pickNumber(entry, ["accountValue", "value", "equity", "vaultEquity"]),
        pnl: pickNumber(entry, ["pnl", "pnlUsd", "closedPnl", "return"])
      };
    })
    .filter((entry): entry is PortfolioPoint => Boolean(entry))
    .sort((left, right) => left.time - right.time);
}

function normalizeVaultEquities(raw: unknown): Array<{ vaultAddress: `0x${string}`; userEquityUsd: number | null }> {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (Array.isArray(entry)) {
        const vaultAddress = normalizeAddress(entry[0]);
        if (!vaultAddress) return null;
        return {
          vaultAddress,
          userEquityUsd: asNumber(entry[1])
        };
      }

      const vaultAddress = normalizeAddress(
        (entry as any)?.vaultAddress ?? (entry as any)?.vault ?? (entry as any)?.address
      );
      if (!vaultAddress) return null;
      return {
        vaultAddress,
        userEquityUsd: pickNumber(entry, ["equity", "vaultEquity", "usd", "value"])
      };
    })
    .filter((entry): entry is { vaultAddress: `0x${string}`; userEquityUsd: number | null } => Boolean(entry));
}

function normalizeVaultDetails(raw: unknown, fallbackVaultAddress: `0x${string}`): Omit<VaultDetailResponse, "updatedAt"> {
  const source = typeof raw === "object" && raw !== null && "vault" in (raw as any)
    ? (raw as any).vault
    : raw;
  const performanceSource =
    typeof raw === "object" && raw !== null && "portfolio" in (raw as any)
      ? (raw as any).portfolio
      : (raw as any)?.performance ?? source;
  const points = normalizePortfolioPoints(performanceSource);

  return {
    vaultAddress: normalizeAddress((source as any)?.vaultAddress ?? (source as any)?.address) ?? fallbackVaultAddress,
    name: pickString(source, ["name", "vaultName"]),
    leader: pickString(source, ["leader", "leaderAddress"]),
    description: pickString(source, ["description", "summary"]),
    userEquityUsd: pickNumber(source, ["userEquity", "vaultEquity", "equity"]),
    userRole: pickString(source, ["userRole", "role"]),
    apr: pickNumber(source, ["apr", "aprPct", "aprPercent"]),
    allTimeReturnPct: pickNumber(source, ["allTimeReturnPct", "returnPct", "performancePct"]),
    maxDrawdownPct: pickNumber(source, ["maxDrawdownPct", "drawdownPct"]),
    tvlUsd: pickNumber(source, ["tvlUsd", "tvl", "equity"]),
    followerCount: pickNumber(source, ["followerCount", "followers", "numFollowers"]),
    performance: {
      points,
      available: points.length > 0
    }
  };
}

function normalizeRole(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object") {
    return pickString(raw, ["role", "userRole", "type"]);
  }
  return null;
}

function normalizeActivity(raw: unknown, limit: number): WalletActivityItem[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry: any, index): WalletActivityItem | null => {
      const timestamp = pickNumber(entry, ["time", "timestamp", "ts"]);
      if (timestamp === null) return null;
      return {
        id: pickString(entry, ["tid", "hash", "txHash"]) ?? `fill_${timestamp}_${index}`,
        type: "fill",
        symbol: pickString(entry, ["coin", "symbol"]),
        title: null,
        description: null,
        side: pickString(entry, ["side", "dir"]),
        size: pickNumber(entry, ["sz", "size"]),
        price: pickNumber(entry, ["px", "price"]),
        closedPnlUsd: pickNumber(entry, ["closedPnl", "closedPnlUsd", "pnl"]),
        feeUsd: pickNumber(entry, ["fee", "feeUsd"]),
        status: null,
        timestamp,
        txHash: pickString(entry, ["hash", "txHash"])
      };
    })
    .filter((entry): entry is WalletActivityItem => Boolean(entry))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

function normalizeActivityStatus(value: string): WalletActivityItem["status"] {
  if (value === "prepared" || value === "submitted" || value === "confirmed" || value === "failed") {
    return value;
  }
  return null;
}

function normalizeActionActivity(items: WalletActivitySourceItem[] | null | undefined): WalletActivityItem[] {
  const normalized: WalletActivityItem[] = [];
  for (const item of items ?? []) {
      const timestampSource = item.updatedAt ?? item.createdAt;
      const timestamp = timestampSource ? Date.parse(timestampSource) : NaN;
      if (!Number.isFinite(timestamp)) continue;

      if (item.actionType === "create_master_vault") {
        normalized.push({
          id: item.id,
          type: "action",
          symbol: null,
          title: "MasterVault created",
          description: "Onchain MasterVault creation confirmed in wallet history.",
          side: null,
          size: null,
          price: null,
          closedPnlUsd: null,
          feeUsd: null,
          status: normalizeActivityStatus(item.status),
          timestamp,
          txHash: item.txHash
        });
        continue;
      }
      if (item.actionType === "deposit_master_vault") {
        normalized.push({
          id: item.id,
          type: "action",
          symbol: null,
          title: "MasterVault deposit",
          description: "Wallet deposit into the MasterVault tracked by onchain action history.",
          side: null,
          size: null,
          price: null,
          closedPnlUsd: null,
          feeUsd: null,
          status: normalizeActivityStatus(item.status),
          timestamp,
          txHash: item.txHash
        });
        continue;
      }
      if (item.actionType === "withdraw_master_vault") {
        normalized.push({
          id: item.id,
          type: "action",
          symbol: null,
          title: "MasterVault withdraw",
          description: "Wallet withdrawal from the MasterVault tracked by onchain action history.",
          side: null,
          size: null,
          price: null,
          closedPnlUsd: null,
          feeUsd: null,
          status: normalizeActivityStatus(item.status),
          timestamp,
          txHash: item.txHash
        });
      }
    }
  return normalized;
}

async function parseInfoResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`hyperliquid_info_request_failed:${response.status}:${payload}`);
  }
  return response.json() as Promise<T>;
}

export function createWalletReadService(config: WalletReadConfig = resolveWalletReadConfig()): WalletReadService {
  const publicClient: PublicClient = createPublicClient({
    chain: defineChain({
      id: config.hyperEvmChainId,
      name: "HyperEVM",
      nativeCurrency: {
        name: "Hyperliquid",
        symbol: "HYPE",
        decimals: 18
      },
      rpcUrls: {
        default: {
          http: [config.hyperEvmRpcUrl]
        }
      }
    }),
    transport: http(config.hyperEvmRpcUrl)
  });

  async function postInfo<T>(payload: HyperliquidInfoRequest): Promise<T> {
    const response = await fetch(config.hyperliquidInfoUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    return parseInfoResponse<T>(response);
  }

  async function readBalances(address: `0x${string}`) {
    const hypeRaw = await publicClient.getBalance({ address });
    const usdcRaw = config.usdcAddress
      ? await publicClient.readContract({
          address: config.usdcAddress,
          abi: erc20ReadAbi,
          functionName: "balanceOf",
          args: [address]
        }).catch(() => 0n)
      : null;

    return {
      hype: normalizeBalance("HYPE", 18, hypeRaw),
      usdc: usdcRaw === null ? null : normalizeBalance("USDC", config.usdcDecimals, usdcRaw as bigint)
    };
  }

  async function getWalletVaults(params: { address: string }) {
    const user = normalizeAddress(params.address);
    if (!user) throw new Error("invalid_wallet_address");

    const rawEquities = await postInfo<unknown>({
      type: "userVaultEquities",
      user
    }).catch(() => []);
    const equities = normalizeVaultEquities(rawEquities);
    const items = await Promise.all(
      equities.map(async (equity) => {
        const rawDetail = await postInfo<unknown>({
          type: "vaultDetails",
          vaultAddress: equity.vaultAddress,
          user
        }).catch(() => null);
        const detail = normalizeVaultDetails(rawDetail, equity.vaultAddress);
        return {
          vaultAddress: equity.vaultAddress,
          name: detail.name,
          leader: detail.leader,
          description: detail.description,
          userEquityUsd: equity.userEquityUsd ?? detail.userEquityUsd,
          userRole: detail.userRole,
          apr: detail.apr,
          allTimeReturnPct: detail.allTimeReturnPct,
          tvlUsd: detail.tvlUsd,
          followerCount: detail.followerCount
        } satisfies WalletVaultItem;
      })
    );

    return {
      address: user,
      items,
      updatedAt: new Date().toISOString()
    };
  }

  async function getWalletOverview(params: { address: string }): Promise<WalletOverviewResponse> {
    const user = normalizeAddress(params.address);
    if (!user) throw new Error("invalid_wallet_address");

    const [balances, walletVaults, rawPortfolio, rawRole] = await Promise.all([
      readBalances(user),
      getWalletVaults({ address: user }),
      postInfo<unknown>({ type: "portfolio", user }).catch(() => null),
      postInfo<unknown>({ type: "userRole", user }).catch(() => null)
    ]);
    const portfolioPoints = normalizePortfolioPoints(rawPortfolio);

    return {
      address: user,
      network: {
        chainId: config.hyperEvmChainId,
        name: "HyperEVM",
        rpcUrl: config.hyperEvmRpcUrl,
        explorerUrl: config.hyperEvmExplorerUrl
      },
      balances,
      vaultSummary: {
        count: walletVaults.items.length,
        totalEquityUsd: walletVaults.items.reduce((sum, item) => sum + Number(item.userEquityUsd ?? 0), 0)
      },
      portfolio: {
        points: portfolioPoints,
        available: portfolioPoints.length > 0
      },
      role: normalizeRole(rawRole),
      masterVault: {
        configured: Boolean(config.masterVaultAddress && config.usdcAddress),
        address: config.masterVaultAddress,
        usdcAddress: config.usdcAddress
      },
      config: {
        errors: config.errors
      },
      updatedAt: new Date().toISOString()
    };
  }

  async function getVaultDetails(params: { vaultAddress: string; userAddress?: string | null }): Promise<VaultDetailResponse> {
    const vaultAddress = normalizeAddress(params.vaultAddress);
    const userAddress = normalizeAddress(params.userAddress ?? "");
    if (!vaultAddress) throw new Error("invalid_vault_address");

    const rawDetail = await postInfo<unknown>({
      type: "vaultDetails",
      vaultAddress,
      ...(userAddress ? { user: userAddress } : {})
    });
    return {
      ...normalizeVaultDetails(rawDetail, vaultAddress),
      updatedAt: new Date().toISOString()
    };
  }

  async function getWalletActivity(params: { address: string; limit?: number; items?: WalletActivitySourceItem[] | null }): Promise<WalletActivityResponse> {
    const user = normalizeAddress(params.address);
    if (!user) throw new Error("invalid_wallet_address");

    const limit = Math.max(1, Math.min(50, Math.trunc(Number(params.limit ?? 20) || 20)));
    const rawActivity = await postInfo<unknown>({
      type: "userFillsByTime",
      user,
      startTime: Date.now() - 7 * DAY_MS
    }).catch(() => []);

    const activityItems = [
      ...normalizeActivity(rawActivity, limit),
      ...normalizeActionActivity(params.items)
    ]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);

    return {
      address: user,
      items: activityItems,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    getWalletOverview,
    getWalletVaults,
    getVaultDetails,
    getWalletActivity
  };
}
