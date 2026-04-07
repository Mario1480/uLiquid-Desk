import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_REST_BASE_URL } from "./hyperliquid.constants.js";

const RETRYABLE_INFO_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function resolveInfoUrl(): string {
  const raw = String(process.env.HYPERLIQUID_REST_BASE_URL ?? HYPERLIQUID_DEFAULT_REST_BASE_URL).trim();
  const normalized = raw.replace(/\/+$/, "");
  return normalized.endsWith("/info") ? normalized : `${normalized}/info`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postInfo<T>(payload: Record<string, unknown>): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(resolveInfoUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return response.json() as Promise<T>;
      }

      const message = await response.text().catch(() => "");
      lastError = new Error(`hyperliquid_info_request_failed:${response.status}:${message}`);
      if (!RETRYABLE_INFO_STATUS_CODES.has(response.status) || attempt >= 2) {
        throw lastError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 2) {
        throw lastError;
      }
    }
    await sleep(150 * (attempt + 1));
  }
  throw lastError ?? new Error("hyperliquid_info_request_failed:unknown");
}

export async function readHyperliquidClearinghouseState(sdk: Hyperliquid, userAddress: string): Promise<any> {
  try {
    return await sdk.info.perpetuals.getClearinghouseState(userAddress, true);
  } catch {
    return postInfo({
      type: "clearinghouseState",
      user: userAddress
    });
  }
}

export async function readHyperliquidFrontendOpenOrders(sdk: Hyperliquid, userAddress: string): Promise<any[]> {
  try {
    const rows = await sdk.info.getFrontendOpenOrders(userAddress, true);
    return Array.isArray(rows) ? rows : [];
  } catch {
    const rows = await postInfo<unknown[]>({
      type: "frontendOpenOrders",
      user: userAddress
    });
    return Array.isArray(rows) ? rows : [];
  }
}

export async function readHyperliquidAllMids(sdk: Hyperliquid): Promise<Record<string, string>> {
  try {
    const rows = await sdk.info.getAllMids(true);
    return rows && typeof rows === "object" ? rows as Record<string, string> : {};
  } catch {
    const rows = await postInfo<unknown>({
      type: "allMids"
    });
    return rows && typeof rows === "object" ? rows as Record<string, string> : {};
  }
}

export async function readHyperliquidSpotClearinghouseState(sdk: Hyperliquid, userAddress: string): Promise<any> {
  try {
    return await (sdk.info as any).spot.getSpotClearinghouseState(userAddress, true);
  } catch {
    return postInfo({
      type: "spotClearinghouseState",
      user: userAddress
    });
  }
}

export async function readHyperliquidSpotMeta(sdk: Hyperliquid): Promise<any> {
  try {
    return await (sdk.info as any).spot.getSpotMeta(true);
  } catch {
    return postInfo({
      type: "spotMeta"
    });
  }
}
