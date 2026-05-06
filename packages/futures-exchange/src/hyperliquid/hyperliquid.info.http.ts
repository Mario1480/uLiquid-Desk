import type { Hyperliquid } from "hyperliquid";
import { HYPERLIQUID_DEFAULT_REST_BASE_URL } from "./hyperliquid.constants.js";
import {
  buildHyperliquidReadKey,
  executeHyperliquidRead
} from "./hyperliquid.read-coordinator.js";

const RETRYABLE_INFO_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_INFO_TTL_MS = 2_000;
const DEFAULT_INFO_STALE_MS = 30_000;
const DEFAULT_INFO_COOLDOWN_MS = 15_000;

function resolveInfoUrl(): string {
  const raw = String(process.env.HYPERLIQUID_REST_BASE_URL ?? HYPERLIQUID_DEFAULT_REST_BASE_URL).trim();
  const normalized = raw.replace(/\/+$/, "");
  return normalized.endsWith("/info") ? normalized : `${normalized}/info`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function isRateLimitError(error: unknown): boolean {
  const status = Number(
    error && typeof error === "object"
      ? ((error as Record<string, unknown>).status ?? (error as Record<string, unknown>).statusCode)
      : undefined
  );
  if (Number.isFinite(status) && Math.trunc(status) === 429) return true;
  const message = String(
    error && typeof error === "object" && "message" in error
      ? (error as Record<string, unknown>).message
      : error
  ).toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("too many requests");
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
      (lastError as Error & { status?: number }).status = response.status;
      if (!RETRYABLE_INFO_STATUS_CODES.has(response.status) || attempt >= 2) {
        throw lastError;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isRateLimitError(lastError) || attempt >= 2) {
        throw lastError;
      }
    }
    await sleep(150 * (attempt + 1));
  }
  throw lastError ?? new Error("hyperliquid_info_request_failed:unknown");
}

async function executeInfoRead<T>(params: {
  endpoint: string;
  identity?: string | null;
  read: () => Promise<T>;
}): Promise<T> {
  const result = await executeHyperliquidRead({
    key: buildHyperliquidReadKey({
      scope: "hyperliquid_info",
      identity: params.identity ?? "global",
      endpoint: params.endpoint
    }),
    ttlMs: readPositiveMs(process.env.HYPERLIQUID_INFO_READ_TTL_MS, DEFAULT_INFO_TTL_MS),
    staleMs: readPositiveMs(process.env.HYPERLIQUID_INFO_READ_STALE_MS, DEFAULT_INFO_STALE_MS),
    cooldownMs: readPositiveMs(process.env.HYPERLIQUID_INFO_READ_COOLDOWN_MS, DEFAULT_INFO_COOLDOWN_MS),
    retryAttempts: 1,
    read: params.read
  });
  return result.value;
}

export async function readHyperliquidClearinghouseState(sdk: Hyperliquid, userAddress: string): Promise<any> {
  return executeInfoRead({
    endpoint: "clearinghouseState",
    identity: userAddress,
    read: async () => {
      try {
        return await sdk.info.perpetuals.getClearinghouseState(userAddress, true);
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        return postInfo({
          type: "clearinghouseState",
          user: userAddress
        });
      }
    }
  });
}

export async function readHyperliquidFrontendOpenOrders(sdk: Hyperliquid, userAddress: string): Promise<any[]> {
  return executeInfoRead({
    endpoint: "frontendOpenOrders",
    identity: userAddress,
    read: async () => {
      try {
        const rows = await sdk.info.getFrontendOpenOrders(userAddress, true);
        return Array.isArray(rows) ? rows : [];
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        const rows = await postInfo<unknown[]>({
          type: "frontendOpenOrders",
          user: userAddress
        });
        return Array.isArray(rows) ? rows : [];
      }
    }
  });
}

export async function readHyperliquidAllMids(sdk: Hyperliquid): Promise<Record<string, string>> {
  return executeInfoRead({
    endpoint: "allMids",
    identity: "global",
    read: async () => {
      try {
        const rows = await sdk.info.getAllMids(true);
        return rows && typeof rows === "object" ? rows as Record<string, string> : {};
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        const rows = await postInfo<unknown>({
          type: "allMids"
        });
        return rows && typeof rows === "object" ? rows as Record<string, string> : {};
      }
    }
  });
}

export async function readHyperliquidSpotClearinghouseState(sdk: Hyperliquid, userAddress: string): Promise<any> {
  return executeInfoRead({
    endpoint: "spotClearinghouseState",
    identity: userAddress,
    read: async () => {
      try {
        return await (sdk.info as any).spot.getSpotClearinghouseState(userAddress, true);
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        return postInfo({
          type: "spotClearinghouseState",
          user: userAddress
        });
      }
    }
  });
}

export async function readHyperliquidSpotMeta(sdk: Hyperliquid): Promise<any> {
  return executeInfoRead({
    endpoint: "spotMeta",
    identity: "global",
    read: async () => {
      try {
        return await (sdk.info as any).spot.getSpotMeta(true);
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        return postInfo({
          type: "spotMeta"
        });
      }
    }
  });
}
