import type { BitgetAccountApi } from "../bitget.account.api.js";
import type { BitgetProductType } from "../bitget.constants.js";
import type { BitgetPositionApi } from "../bitget.position.api.js";

export type BitgetPositionModeHint = {
  mode: "one-way" | "hedge";
  ts: number;
} | null;

export async function resolveBitgetPositionMode(params: {
  accountApi: BitgetAccountApi;
  positionApi?: BitgetPositionApi;
  productType: BitgetProductType;
  marginCoin?: string;
  defaultPositionMode: "one-way" | "hedge";
  currentHint: BitgetPositionModeHint;
  nowMs: number;
  cacheMs: number;
}): Promise<BitgetPositionModeHint> {
  if (
    params.currentHint
    && Number.isFinite(params.cacheMs)
    && params.cacheMs > 0
    && (params.nowMs - params.currentHint.ts) < params.cacheMs
  ) {
    return params.currentHint;
  }

  try {
    const modeRaw = await params.accountApi.getPositionMode(params.productType);
    const text = String(modeRaw?.posMode ?? "").toLowerCase();
    const mode: "one-way" | "hedge" = text.includes("hedge") ? "hedge" : "one-way";
    return { mode, ts: params.nowMs };
  } catch {
    try {
      const positions = await params.positionApi?.getAllPositions({
        productType: params.productType,
        marginCoin: params.marginCoin
      });
      const positionMode = (positions ?? [])
        .map((row) => String(row.posMode ?? "").toLowerCase())
        .find((text) => text.includes("hedge") || text.includes("one_way"));
      if (positionMode) {
        return {
          mode: positionMode.includes("hedge") ? "hedge" : "one-way",
          ts: params.nowMs
        };
      }
    } catch {
      // Fall through to the configured default when Bitget does not expose mode via positions.
    }
    return { mode: params.defaultPositionMode, ts: params.nowMs };
  }
}

export function isBitgetPositionModeOrderTypeMismatch(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  if (!message.includes("order type")) return false;
  return (
    message.includes("unilateral")
    || message.includes("one-way")
    || message.includes("hedge")
    || message.includes("position mode")
  );
}

export function isBitgetMarginModeLockedError(error: unknown): boolean {
  const text = String(error ?? "").toLowerCase();
  return text.includes("margin mode cannot be adjusted")
    || text.includes("currently holding positions or orders");
}
