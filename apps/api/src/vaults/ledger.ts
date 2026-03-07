export type VaultLedgerBookInput = {
  tx: any;
  userId: string;
  masterVaultId: string;
  botVaultId?: string | null;
  gridInstanceId?: string | null;
  entryType: "ALLOCATION" | "REALIZED_PNL" | "PROFIT_SHARE_ACCRUAL" | "WITHDRAWAL" | "ADJUSTMENT";
  amountUsd: number;
  sourceType: string;
  sourceKey: string;
  sourceTs?: Date | null;
  metadataJson?: Record<string, unknown> | null;
};

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return String((error as any).code ?? "") === "P2002";
}

export async function bookVaultLedgerEntry(input: VaultLedgerBookInput): Promise<{
  created: boolean;
  row: any | null;
}> {
  try {
    const row = await input.tx.vaultLedgerEntry.create({
      data: {
        userId: input.userId,
        masterVaultId: input.masterVaultId,
        botVaultId: input.botVaultId ?? null,
        gridInstanceId: input.gridInstanceId ?? null,
        entryType: input.entryType,
        amountUsd: input.amountUsd,
        sourceType: input.sourceType,
        sourceKey: input.sourceKey,
        sourceTs: input.sourceTs ?? null,
        metadataJson: input.metadataJson ?? null
      }
    });
    return {
      created: true,
      row
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return {
      created: false,
      row: null
    };
  }
}
