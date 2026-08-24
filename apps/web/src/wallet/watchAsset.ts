import { getAddress, isAddress } from "viem";

export const ULIQ_TOKEN_SYMBOL = "ULIQ";
export const ULIQ_TOKEN_DECIMALS = 18;
export const ULIQ_TOKEN_IMAGE_PATH = "/images/tokens/uliq-token-512.png";

export type WatchErc20AssetRequest = {
  method: "wallet_watchAsset";
  params: {
    type: "ERC20";
    options: {
      address: `0x${string}`;
      symbol: string;
      decimals: number;
      image: string;
    };
  };
};

export type WalletWatchAssetProvider = {
  request(args: WatchErc20AssetRequest): Promise<unknown>;
};

export function isWalletWatchAssetProvider(value: unknown): value is WalletWatchAssetProvider {
  return typeof value === "object"
    && value !== null
    && "request" in value
    && typeof (value as { request?: unknown }).request === "function";
}

function validateTokenImageUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_token_image_url");
  }
  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new Error("invalid_token_image_url");
  return parsed.toString();
}

export function buildWatchErc20AssetRequest(params: {
  tokenAddress: string;
  imageUrl: string;
  symbol?: string;
  decimals?: number;
}): WatchErc20AssetRequest {
  if (!isAddress(params.tokenAddress)) throw new Error("invalid_token_address");
  const symbol = (params.symbol ?? ULIQ_TOKEN_SYMBOL).trim();
  const decimals = params.decimals ?? ULIQ_TOKEN_DECIMALS;
  if (!/^[A-Z0-9]{1,11}$/.test(symbol)) throw new Error("invalid_token_symbol");
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("invalid_token_decimals");
  return {
    method: "wallet_watchAsset",
    params: {
      type: "ERC20",
      options: {
        address: getAddress(params.tokenAddress),
        symbol,
        decimals,
        image: validateTokenImageUrl(params.imageUrl)
      }
    }
  };
}

export async function requestWalletWatchAsset(
  provider: WalletWatchAssetProvider,
  params: Parameters<typeof buildWatchErc20AssetRequest>[0]
): Promise<boolean> {
  return (await provider.request(buildWatchErc20AssetRequest(params))) === true;
}
