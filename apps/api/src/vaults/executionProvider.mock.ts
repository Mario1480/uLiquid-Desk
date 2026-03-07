import crypto from "node:crypto";
import type { ExecutionProvider } from "./executionProvider.types.js";

function buildMockAddress(seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `0x${hash.slice(0, 40)}`;
}

function buildMockId(prefix: string, seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${prefix}_${hash.slice(0, 16)}`;
}

export function createMockExecutionProvider(): ExecutionProvider {
  return {
    key: "mock",

    async createUserVault(input) {
      return {
        providerVaultId: buildMockId("mock_user_vault", `${input.userId}:${input.masterVaultId}`),
        vaultAddress: buildMockAddress(`mock:user_vault:${input.userId}:${input.masterVaultId}`)
      };
    },

    async createBotExecutionUnit(input) {
      return {
        providerUnitId: buildMockId("mock_bot_unit", `${input.botVaultId}:${input.gridInstanceId}`),
        vaultAddress: buildMockAddress(`mock:bot_unit:${input.botVaultId}:${input.gridInstanceId}`)
      };
    },

    async assignAgent(input) {
      const hint = typeof input.agentWalletHint === "string" ? input.agentWalletHint.trim() : "";
      return {
        agentWallet: hint.length > 0 ? hint : null
      };
    },

    async startBotExecution() {
      return { ok: true };
    },

    async pauseBotExecution() {
      return { ok: true };
    },

    async setBotCloseOnly() {
      return { ok: true };
    },

    async closeBotExecution() {
      return { ok: true };
    },

    async getBotExecutionState() {
      return {
        status: "created",
        equityUsd: null,
        freeUsd: null,
        usedMarginUsd: null,
        positions: [],
        providerMetadata: {
          mode: "mock"
        },
        observedAt: new Date().toISOString()
      };
    }
  };
}
