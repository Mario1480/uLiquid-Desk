"use client";

import { apiPost } from "../api";

export type FundingIntentActionType =
  | "funding_bridge_deposit"
  | "funding_bridge_withdraw"
  | "funding_relay_usdc_to_hyperevm"
  | "funding_relay_hype_topup"
  | "funding_transfer_core_to_evm"
  | "funding_transfer_evm_to_core"
  | "funding_usd_class_transfer";

export type FundingIntentStatus =
  | "prepared"
  | "submitted"
  | "pending_reconciliation"
  | "confirmed"
  | "failed";

export type FundingIntentAction = {
  id: string;
  actionType: FundingIntentActionType;
  status: FundingIntentStatus;
  txHash: string | null;
  metadata: Record<string, unknown> | null;
};

export type CreateFundingIntentInput = {
  actionType: FundingIntentActionType;
  actionKey?: string;
  chainId: number;
  toAddress?: string | null;
  asset: "USDC" | "HYPE";
  direction: string;
  amountRaw: string;
  amountFormatted: string;
  sourceLocation: string;
  destinationLocation: string;
  beforeSourceRaw: string;
  beforeDestinationRaw: string;
  targetDestinationRaw: string;
  reasonCode?: string;
  recoveryHint?: string;
};

export type FundingIntentResponse = {
  ok: boolean;
  action: FundingIntentAction;
};

export type FundingIntentReconcileResponse = FundingIntentResponse & {
  reconciliation: {
    status: "pending_reconciliation" | "confirmed";
    actionId: string;
    observedRaw: string;
    targetRaw: string;
    toleranceRaw: string;
    confirmed: boolean;
    reasonCode: string;
    recoveryHint: string;
  };
};

export function createFundingIntent(address: string, input: CreateFundingIntentInput) {
  return apiPost<FundingIntentResponse>(`/funding/${address}/intents`, input);
}

export function submitFundingIntent(
  intentId: string,
  input: {
    txHash?: string | null;
    status?: "submitted" | "failed";
    reasonCode?: string;
    recoveryHint?: string;
  }
) {
  return apiPost<FundingIntentResponse>(`/funding/intents/${intentId}/submit`, input);
}

export function reconcileFundingIntent(intentId: string) {
  return apiPost<FundingIntentReconcileResponse>(`/funding/intents/${intentId}/reconcile`, {});
}
