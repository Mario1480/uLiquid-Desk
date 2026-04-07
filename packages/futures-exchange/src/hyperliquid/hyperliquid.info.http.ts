import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_REST_BASE_URL } from "./hyperliquid.constants.js";

function resolveInfoUrl(): string {
  const raw = String(process.env.HYPERLIQUID_REST_BASE_URL ?? HYPERLIQUID_DEFAULT_REST_BASE_URL).trim();
  const normalized = raw.replace(/\/+$/, "");
  return normalized.endsWith("/info") ? normalized : `${normalized}/info`;
}

async function postInfo<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(resolveInfoUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`hyperliquid_info_request_failed:${response.status}:${message}`);
  }
  return response.json() as Promise<T>;
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
