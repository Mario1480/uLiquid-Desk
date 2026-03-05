import type { MarginMode } from "@mm/futures-core";
import type { BitgetContractInfo } from "./bitget.types.js";
import { normalizeOrderInput } from "./bitget.sizing.js";
import type { NormalizedOrderIntent, OrderIntent } from "../core/order-normalization.types.js";

export function mapBitgetMarginMode(mode: MarginMode): "isolated" | "crossed" {
  return mode === "isolated" ? "isolated" : "crossed";
}

export function deriveBitgetTradeSide(
  positionMode: "one-way" | "hedge",
  reduceOnly: boolean
): "open" | "close" | undefined {
  if (positionMode !== "hedge") return undefined;
  return reduceOnly ? "close" : "open";
}

export function toBitgetReduceOnlyFlag(reduceOnly: boolean | undefined): "YES" | undefined {
  return reduceOnly ? "YES" : undefined;
}

export function normalizeBitgetOrderIntent(params: {
  contract: BitgetContractInfo;
  intent: OrderIntent;
}): NormalizedOrderIntent {
  const normalized = normalizeOrderInput({
    contract: params.contract,
    qty: params.intent.qty,
    price: params.intent.price,
    type: params.intent.type,
    roundingMode: "down"
  });

  return {
    ...params.intent,
    exchangeSymbol: params.contract.exchangeSymbol,
    normalizedQty: normalized.qty,
    normalizedPrice: normalized.price,
    metadata: {
      contractSymbol: params.contract.canonicalSymbol,
      contractStatus: params.contract.symbolStatus,
      contractApiAllowed: params.contract.apiAllowed
    }
  };
}

export function validateBitgetTpSl(intent: NormalizedOrderIntent): void {
  const tp = intent.takeProfitPrice;
  const sl = intent.stopLossPrice;
  if (tp !== undefined && (!Number.isFinite(tp) || tp <= 0)) {
    throw new Error("bitget_invalid_take_profit");
  }
  if (sl !== undefined && (!Number.isFinite(sl) || sl <= 0)) {
    throw new Error("bitget_invalid_stop_loss");
  }
}
