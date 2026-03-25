export type OnchainTxRequest = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
};

export type OnchainActionType =
  | "create_master_vault"
  | "deposit_master_vault"
  | "withdraw_master_vault"
  | "create_bot_vault"
  | "set_bot_vault_close_only"
  | "claim_from_bot_vault"
  | "close_bot_vault"
  | "set_treasury_recipient"
  | "set_profit_share_fee_rate";

export interface OnchainProvider {
  buildCreateMasterVaultTx(input: {
    ownerAddress: `0x${string}`;
  }): Promise<OnchainTxRequest>;
  buildDepositToMasterVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    amountAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildWithdrawFromMasterVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    amountAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildCreateBotVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    templateId: string;
    botId: string;
    allocationAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildSetBotVaultCloseOnlyTx(input: {
    masterVaultAddress: `0x${string}`;
    botVaultAddress: `0x${string}`;
  }): Promise<OnchainTxRequest>;
  buildSetTreasuryRecipientTx(input: {
    treasuryRecipient: `0x${string}`;
  }): Promise<OnchainTxRequest>;
  buildSetProfitShareFeeRateTx(input: {
    feeRatePct: bigint;
  }): Promise<OnchainTxRequest>;
  buildClaimFromBotVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    botVaultAddress: `0x${string}`;
    releasedReservedAtomic: bigint;
    grossReturnedAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildCloseBotVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    botVaultAddress: `0x${string}`;
    releasedReservedAtomic: bigint;
    grossReturnedAtomic: bigint;
  }): Promise<OnchainTxRequest>;
}
