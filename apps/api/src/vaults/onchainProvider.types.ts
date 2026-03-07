export type OnchainTxRequest = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
};

export type OnchainActionType =
  | "create_master_vault"
  | "deposit_master_vault"
  | "create_bot_vault"
  | "claim_from_bot_vault"
  | "close_bot_vault";

export interface OnchainProvider {
  buildCreateMasterVaultTx(input: {
    ownerAddress: `0x${string}`;
  }): Promise<OnchainTxRequest>;
  buildDepositToMasterVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    amountAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildCreateBotVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    templateId: string;
    botId: string;
    allocationAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildClaimFromBotVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    botVaultAddress: `0x${string}`;
    releasedReservedAtomic: bigint;
    returnedToFreeAtomic: bigint;
  }): Promise<OnchainTxRequest>;
  buildCloseBotVaultTx(input: {
    masterVaultAddress: `0x${string}`;
    botVaultAddress: `0x${string}`;
    releasedReservedAtomic: bigint;
    returnedToFreeAtomic: bigint;
  }): Promise<OnchainTxRequest>;
}
