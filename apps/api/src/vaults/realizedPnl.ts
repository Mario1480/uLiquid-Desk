import { roundUsd } from "./profitShare.js";

type Side = "buy" | "sell";

type MatchingLot = {
  qty: number;
  price: number;
  feePerUnit: number;
};

export type BotVaultMatchingState = {
  version: 1;
  longLots: MatchingLot[];
  shortLots: MatchingLot[];
};

export type RealizedFillInput = {
  side: Side;
  price: number;
  qty: number;
  feeUsd: number;
};

export type RealizedFillResult = {
  nextState: BotVaultMatchingState;
  realizedGrossUsd: number;
  realizedFeesUsd: number;
  realizedNetUsd: number;
};

const EMPTY_STATE: BotVaultMatchingState = {
  version: 1,
  longLots: [],
  shortLots: []
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function sanitizeLots(value: unknown): MatchingLot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const qty = toNumber(row.qty, 0);
      const price = toNumber(row.price, 0);
      const feePerUnit = Math.max(0, toNumber(row.feePerUnit, 0));
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(price) || price <= 0) return null;
      return {
        qty: Number(qty.toFixed(12)),
        price: Number(price.toFixed(12)),
        feePerUnit: Number(feePerUnit.toFixed(12))
      };
    })
    .filter((entry): entry is MatchingLot => Boolean(entry));
}

export function parseBotVaultMatchingState(raw: unknown): BotVaultMatchingState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_STATE };
  const row = raw as Record<string, unknown>;
  return {
    version: 1,
    longLots: sanitizeLots(row.longLots),
    shortLots: sanitizeLots(row.shortLots)
  };
}

function allocateFeePart(totalFee: number, partQty: number, totalQty: number): number {
  if (!Number.isFinite(totalFee) || totalFee <= 0) return 0;
  if (!Number.isFinite(partQty) || partQty <= 0) return 0;
  if (!Number.isFinite(totalQty) || totalQty <= 0) return 0;
  return totalFee * (partQty / totalQty);
}

export function applyFillToRealizedPnl(
  currentState: BotVaultMatchingState,
  fill: RealizedFillInput
): RealizedFillResult {
  const state: BotVaultMatchingState = {
    version: 1,
    longLots: currentState.longLots.map((row) => ({ ...row })),
    shortLots: currentState.shortLots.map((row) => ({ ...row }))
  };

  const side = fill.side === "sell" ? "sell" : "buy";
  const fillQtyTotal = Math.max(0, toNumber(fill.qty, 0));
  const fillPrice = Math.max(0, toNumber(fill.price, 0));
  const fillFeeTotal = Math.max(0, Math.abs(toNumber(fill.feeUsd, 0)));
  if (fillQtyTotal <= 0 || fillPrice <= 0) {
    return {
      nextState: state,
      realizedGrossUsd: 0,
      realizedFeesUsd: 0,
      realizedNetUsd: 0
    };
  }

  let remainingQty = fillQtyTotal;
  let realizedGrossUsd = 0;
  let realizedFeesUsd = 0;

  if (side === "sell") {
    while (remainingQty > 0 && state.longLots.length > 0) {
      const lot = state.longLots[0];
      const matchedQty = Math.min(remainingQty, lot.qty);
      const entryFeePart = lot.feePerUnit * matchedQty;
      const exitFeePart = allocateFeePart(fillFeeTotal, matchedQty, fillQtyTotal);
      realizedGrossUsd += (fillPrice - lot.price) * matchedQty;
      realizedFeesUsd += entryFeePart + exitFeePart;
      lot.qty = Number((lot.qty - matchedQty).toFixed(12));
      remainingQty = Number((remainingQty - matchedQty).toFixed(12));
      if (lot.qty <= 0) state.longLots.shift();
    }
    if (remainingQty > 0) {
      const openFee = allocateFeePart(fillFeeTotal, remainingQty, fillQtyTotal);
      state.shortLots.push({
        qty: Number(remainingQty.toFixed(12)),
        price: Number(fillPrice.toFixed(12)),
        feePerUnit: Number((openFee / remainingQty).toFixed(12))
      });
    }
  } else {
    while (remainingQty > 0 && state.shortLots.length > 0) {
      const lot = state.shortLots[0];
      const matchedQty = Math.min(remainingQty, lot.qty);
      const entryFeePart = lot.feePerUnit * matchedQty;
      const exitFeePart = allocateFeePart(fillFeeTotal, matchedQty, fillQtyTotal);
      realizedGrossUsd += (lot.price - fillPrice) * matchedQty;
      realizedFeesUsd += entryFeePart + exitFeePart;
      lot.qty = Number((lot.qty - matchedQty).toFixed(12));
      remainingQty = Number((remainingQty - matchedQty).toFixed(12));
      if (lot.qty <= 0) state.shortLots.shift();
    }
    if (remainingQty > 0) {
      const openFee = allocateFeePart(fillFeeTotal, remainingQty, fillQtyTotal);
      state.longLots.push({
        qty: Number(remainingQty.toFixed(12)),
        price: Number(fillPrice.toFixed(12)),
        feePerUnit: Number((openFee / remainingQty).toFixed(12))
      });
    }
  }

  const realizedGrossRounded = roundUsd(realizedGrossUsd, 6);
  const realizedFeesRounded = roundUsd(realizedFeesUsd, 6);
  const realizedNetRounded = roundUsd(realizedGrossRounded - realizedFeesRounded, 6);

  return {
    nextState: state,
    realizedGrossUsd: realizedGrossRounded,
    realizedFeesUsd: realizedFeesRounded,
    realizedNetUsd: realizedNetRounded
  };
}
