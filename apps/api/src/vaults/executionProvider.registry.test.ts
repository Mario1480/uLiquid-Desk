import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionProvider } from "./executionProvider.registry.js";

function createDb(params?: {
  globalProvider?: "mock" | "hyperliquid_demo";
  pilotEnabled?: boolean;
  allowedUserIds?: string[];
  adminUserIds?: string[];
  botVaultProvider?: string | null;
}) {
  const botVaultRow = {
    id: "bv_1",
    userId: "plain_user",
    masterVaultId: "mv_1",
    templateId: "tpl_1",
    gridInstanceId: "grid_1",
    vaultAddress: null,
    agentWallet: null,
    executionStatus: "created",
    executionMetadata: {},
    availableUsd: 100,
    principalAllocated: 100,
    principalReturned: 0
  };
  return {
    globalSetting: {
      async findUnique(args: any) {
        const key = String(args?.where?.key ?? "");
        if (key === "admin.vaultExecutionProvider.v1") {
          if (!params?.globalProvider) return null;
          return { value: { provider: params.globalProvider }, updatedAt: new Date("2026-03-09T12:00:00.000Z") };
        }
        if (key === "admin.gridHyperliquidPilot.v1") {
          return {
            value: {
              enabled: Boolean(params?.pilotEnabled),
              allowedUserIds: params?.allowedUserIds ?? [],
              allowedWorkspaceIds: []
            },
            updatedAt: new Date("2026-03-09T12:00:00.000Z")
          };
        }
        if (key === "admin.backendAccess") {
          return { value: { userIds: params?.adminUserIds ?? [] } };
        }
        return null;
      }
    },
    workspaceMember: {
      async findFirst() {
        return null;
      }
    },
    botVault: {
      async findUnique() {
        if (!params?.botVaultProvider) return null;
        return { executionProvider: params.botVaultProvider, ...botVaultRow };
      },
      async findFirst() {
        return { ...botVaultRow };
      },
      async update(args: any) {
        botVaultRow.executionMetadata = args?.data?.executionMetadata ?? botVaultRow.executionMetadata;
        return { ...botVaultRow };
      }
    }
  } as any;
}

test("execution provider registry uses pilot override for allowlisted users", async () => {
  const provider = createExecutionProvider({
    db: createDb({ globalProvider: "mock", pilotEnabled: true, allowedUserIds: ["pilot_user"] })
  });

  await provider.createUserVault({ userId: "pilot_user", masterVaultId: "mv_1" });
  assert.equal(provider.key, "hyperliquid_demo");
  assert.deepEqual(provider.resolutionContext, {
    selectionReason: "pilot_override",
    pilotScope: "user",
    pilotAllowed: true
  });
});

test("execution provider registry uses global default for non-pilot users", async () => {
  const provider = createExecutionProvider({
    db: createDb({ globalProvider: "mock", pilotEnabled: true, allowedUserIds: ["someone_else"] })
  });

  await provider.createUserVault({ userId: "plain_user", masterVaultId: "mv_1" });
  assert.equal(provider.key, "mock");
  assert.deepEqual(provider.resolutionContext, {
    selectionReason: "global_default",
    pilotScope: "none",
    pilotAllowed: false
  });
});

test("execution provider registry sticks to persisted hyperliquid_demo bot vaults", async () => {
  const provider = createExecutionProvider({
    db: createDb({ globalProvider: "mock", pilotEnabled: false, botVaultProvider: "hyperliquid_demo" })
  });

  await provider.startBotExecution({ userId: "plain_user", botVaultId: "bv_1" });
  assert.equal(provider.key, "hyperliquid_demo");
  assert.deepEqual(provider.resolutionContext, {
    selectionReason: "sticky_existing_vault",
    pilotScope: "none",
    pilotAllowed: true
  });
});
