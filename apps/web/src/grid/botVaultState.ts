import type { BotVaultSnapshot } from "../../components/grid/types.js";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function hasExistingOnchainBotVault(params: {
  explicit?: boolean | null;
  botVault?: BotVaultSnapshot | null;
}): boolean {
  if (typeof params.explicit === "boolean") return params.explicit;
  const botVault = params.botVault ?? null;
  if (!botVault) return false;
  const summary = botVault.providerMetadataSummary;
  if (
    normalizeText(summary?.vaultAddress)
    || normalizeText(summary?.agentWallet)
    || normalizeText(summary?.subaccountAddress)
  ) {
    return true;
  }
  const status = normalizeText(botVault.status);
  const executionStatus = normalizeText(botVault.executionStatus);
  return (
    status === "close_only"
    || status === "closed"
    || status === "settling"
    || executionStatus === "close_only"
    || executionStatus === "closed"
  );
}
